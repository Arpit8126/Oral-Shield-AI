FROM python:3.10-slim

# Install system dependencies for OpenCV and curl
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first (for Docker layer caching)
COPY requirements.txt .
# Optimize tensorflow package size for Render deployment
RUN sed -i 's/tensorflow>=/tensorflow-cpu>=/g' requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend files
COPY . .

# Download the actual large model file from GitHub LFS media storage to replace the LFS pointer
RUN curl -L -o oral_best_model.keras https://media.githubusercontent.com/media/Arpit8126/Oral-Shield-AI/main/backend/oral_best_model.keras

# Hugging Face Spaces uses port 7860
EXPOSE 7860

# Start FastAPI with uvicorn on port 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]


