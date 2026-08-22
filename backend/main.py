import os
# Configure TensorFlow to minimize CPU memory usage (critical for Render's 512MB RAM limit)
os.environ["TF_NUM_INTEROP_THREADS"] = "1"
os.environ["TF_NUM_INTRAOP_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

import json
import base64
import gc
import numpy as np
import cv2
import tensorflow as tf

# Limit threading inside TensorFlow runtime
tf.config.threading.set_intra_op_parallelism_threads(1)
tf.config.threading.set_inter_op_parallelism_threads(1)

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager


# Load configuration and establish settings
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "model_config.json")
MODEL_PATH = os.path.join(os.path.dirname(__file__), "oral_best_model.keras")

if not os.path.exists(CONFIG_PATH):
    raise FileNotFoundError(f"Model config not found at {CONFIG_PATH}")

with open(CONFIG_PATH, "r") as f:
    config = json.load(f)

OPTIMAL_THRESHOLD = config.get("optimal_threshold", 0.480)
CLASS_LABELS = config.get("classes", ["Cont", "Sus"])
ACCURACY = config.get("accuracy", 0.904)
ROC_AUC = config.get("roc_auc", 0.9609)

# Global variables for loaded model and sub-models
model = None
grad_model = None
LAST_CONV_LAYER = "conv5_block3_3_conv"

def get_gradcam_heatmap(img_tensor, grad_model_inst):
    """
    Computes Grad-CAM heatmap for ResNet50 model.
    """
    try:
        # Compute gradient of class score with respect to feature maps of last conv layer
        with tf.GradientTape() as tape:
            conv_outputs, predictions = grad_model_inst(img_tensor)
            # The model outputs a single probability value for the 'Sus' class
            score = predictions[:, 0]
            
        # Get the gradients
        grads = tape.gradient(score, conv_outputs)
        
        # Mean intensity of gradients for each feature map channel
        pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
        
        # Multiply each channel in feature map by its gradient weight
        conv_outputs = conv_outputs[0]
        heatmap = conv_outputs @ pooled_grads[..., tf.newaxis]
        heatmap = tf.squeeze(heatmap)
        
        # Apply ReLU to keep positive contributions, and normalize
        heatmap = tf.maximum(heatmap, 0.0)
        max_val = tf.math.reduce_max(heatmap)
        if max_val > 0:
            heatmap = heatmap / max_val
            
        return heatmap.numpy()
    except Exception as e:
        print(f"Error generating Grad-CAM heatmap: {e}")
        return None

def superimpose_heatmap(original_bgr, heatmap, alpha=0.4):
    """
    Superimposes heatmap onto original BGR image.
    """
    try:
        # Resize heatmap to match the original image size
        heatmap_resized = cv2.resize(heatmap, (original_bgr.shape[1], original_bgr.shape[0]))
        
        # Convert heatmap to uint8 (0-255)
        heatmap_uint8 = np.uint8(255 * heatmap_resized)
        
        # Apply JET colormap (returns BGR)
        colormap_bgr = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
        
        # Blending original image with heatmap
        superimposed_bgr = cv2.addWeighted(colormap_bgr, alpha, original_bgr, 1.0 - alpha, 0)
        return superimposed_bgr
    except Exception as e:
        print(f"Error superimposing heatmap: {e}")
        return None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load model on startup
    global model, grad_model
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")
        
    print(f"Loading Keras model from {MODEL_PATH}...")
    # Load model with compile=False to save ~70MB+ RAM by not loading training optimizer params
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    
    # Construct Grad-CAM model mapping input to last conv layer output & prediction
    try:
        last_conv = model.get_layer(LAST_CONV_LAYER)
        grad_model = tf.keras.models.Model(
            model.inputs, [last_conv.output, model.output]
        )
        print("Grad-CAM sub-model constructed successfully.")
    except Exception as e:
        print(f"Failed to initialize Grad-CAM layer '{LAST_CONV_LAYER}': {e}")
        
    # Free up original model reference since we only need the grad_model for predictions
    del model
    model = None
    gc.collect()
    print("Model loaded and memory collected. Ready.")
    yield
    # Clean up (if needed) on shutdown
    print("Shutting down API...")



# Initialize FastAPI App
app = FastAPI(
    title="Oral Lesion Screening System API",
    description="Clinical-grade binary classifier API for Oral Lesion screening utilizing ResNet50.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production Vercel deployment URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "system": "AI-Powered Oral Lesion Screening System",
        "metrics": {
            "accuracy": ACCURACY,
            "roc_auc": ROC_AUC,
            "optimal_threshold": OPTIMAL_THRESHOLD
        },
        "model_loaded": model is not None
    }

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    gradcam: bool = Query(default=True, description="Generate Grad-CAM activation heatmap overlay")
):
    # 1. Read uploaded file bytes
    try:
        contents = await file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to read uploaded file.")
        
    # 2. Decode image using OpenCV
    nparr = np.frombuffer(contents, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img_bgr is None:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")
        
    # 3. Preprocess image for ResNet50
    # ResNet50 is trained on RGB images. OpenCV imdecode loads BGR, so convert to RGB.
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    img_resized = cv2.resize(img_rgb, (224, 224), interpolation=cv2.INTER_AREA)
    img_scaled = img_resized / 255.0
    img_tensor = np.expand_dims(img_scaled, axis=0)
    
    # 4. Perform prediction
    try:
        # Use grad_model directly to avoid calling model.predict (saving overhead and memory)
        _, predictions = grad_model(img_tensor, training=False)
        prob = float(predictions[0][0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference engine failure: {str(e)}")

        
    # Classify based on optimal threshold
    is_suspicious = prob >= OPTIMAL_THRESHOLD
    predicted_label = "Sus" if is_suspicious else "Cont"
    
    # Triage message details
    # For a suspicious lesion, confidence is probability.
    # For a normal case, confidence is the probability of normal (1.0 - prob).
    confidence = prob if is_suspicious else (1.0 - prob)
    
    # 5. Optional: Grad-CAM overlay
    gradcam_base64 = None
    if gradcam and grad_model is not None:
        heatmap = get_gradcam_heatmap(img_tensor, grad_model)
        if heatmap is not None:
            superimposed_bgr = superimpose_heatmap(img_bgr, heatmap, alpha=0.4)
            if superimposed_bgr is not None:
                # Encode BGR image to JPEG bytes
                success, buffer = cv2.imencode(".jpg", superimposed_bgr)
                if success:
                    gradcam_base64 = base64.b64encode(buffer).decode("utf-8")

    return {
        "prediction": predicted_label,
        "is_suspicious": is_suspicious,
        "suspicion_probability": round(prob * 100, 2),
        "confidence": round(confidence * 100, 2),
        "threshold": OPTIMAL_THRESHOLD,
        "gradcam_image": gradcam_base64
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
