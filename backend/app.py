"""
HF Spaces entry point (Gradio SDK).
Mounts FastAPI app inside Gradio so /predict remains accessible.
"""
import gradio as gr
from main import app  # your existing FastAPI app

# Minimal Gradio UI (required for HF Spaces Gradio SDK to start)
with gr.Blocks(title="OralShield API") as demo:
    gr.Markdown("## OralShield AI — Backend API")
    gr.Markdown("API is running. Connect your frontend to /predict.")

# Mount Gradio at /ui; FastAPI routes (/predict, /) remain at root
app = gr.mount_gradio_app(app, demo, path="/ui")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
