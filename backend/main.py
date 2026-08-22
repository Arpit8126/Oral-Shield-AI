import os
import json
import base64
import gc
import numpy as np
import cv2
import onnxruntime as ort
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# Load configuration and establish settings
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "model_config.json")
MODEL_PATH = os.path.join(os.path.dirname(__file__), "oral_best_model.onnx")
WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), "dense_weights.npz")

if not os.path.exists(CONFIG_PATH):
    raise FileNotFoundError(f"Model config not found at {CONFIG_PATH}")

with open(CONFIG_PATH, "r") as f:
    config = json.load(f)

OPTIMAL_THRESHOLD = config.get("optimal_threshold", 0.480)
CLASS_LABELS = config.get("classes", ["Cont", "Sus"])
ACCURACY = config.get("accuracy", 0.904)
ROC_AUC = config.get("roc_auc", 0.9609)

# Global variables for ONNX Runtime session and weights
ort_session = None
W_dense = None
W_dense_1 = None

def get_gradcam_heatmap(conv_outputs, dense_outputs, W_dense_weights, W_dense_1_weights):
    """
    Computes analytical Grad-CAM heatmap for ResNet50 model using ONNX outputs and weights.
    """
    try:
        # Active units mask where ReLU was positive (> 0)
        active_mask = (dense_outputs > 0).astype(np.float32)
        
        # Compute analytical weights for each channel: alpha_k = sum_m (W_dense_1_m * W_dense_km * mask_m)
        alpha = np.dot(W_dense_weights, W_dense_1_weights.flatten() * active_mask)
        
        # Compute heatmap: ReLU(sum_k alpha_k * A_k)
        heatmap = conv_outputs @ alpha[..., np.newaxis]
        heatmap = np.squeeze(heatmap)
        
        # Apply ReLU to keep positive contributions, and normalize
        heatmap = np.maximum(heatmap, 0.0)
        max_val = np.max(heatmap)
        if max_val > 0:
            heatmap = heatmap / max_val
            
        return heatmap
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
    global ort_session, W_dense, W_dense_1
    
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"ONNX model file not found at {MODEL_PATH}")
    if not os.path.exists(WEIGHTS_PATH):
        raise FileNotFoundError(f"Weights file not found at {WEIGHTS_PATH}")
        
    print(f"Loading ONNX model from {MODEL_PATH}...")
    # Limit ONNX threads to 1 to minimize memory usage
    sess_options = ort.SessionOptions()
    sess_options.intra_op_num_threads = 1
    sess_options.inter_op_num_threads = 1
    ort_session = ort.InferenceSession(MODEL_PATH, sess_options)
    
    print(f"Loading weights from {WEIGHTS_PATH}...")
    weights = np.load(WEIGHTS_PATH)
    W_dense = weights['W_dense']
    W_dense_1 = weights['W_dense_1']
    
    gc.collect()
    print("ONNX model and weights loaded successfully.")
    yield
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
        "model_loaded": ort_session is not None
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
        # Run ONNX Runtime session
        input_name = ort_session.get_inputs()[0].name
        onnx_outputs = ort_session.run(None, {input_name: img_tensor.astype(np.float32)})
        
        conv_outputs = onnx_outputs[0][0]  # shape: (7, 7, 2048)
        dense_outputs = onnx_outputs[1][0] # shape: (256,)
        prob = float(onnx_outputs[2][0][0])
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
    if gradcam and ort_session is not None:
        heatmap = get_gradcam_heatmap(conv_outputs, dense_outputs, W_dense, W_dense_1)
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
