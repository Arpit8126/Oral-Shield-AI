FROM python:3.10-slim

# Install system dependencies for OpenCV, git, and git-lfs
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    git \
    git-lfs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first (for Docker layer caching)
COPY requirements.txt .
# Optimize tensorflow package size for Render deployment
RUN sed -i 's/tensorflow>=/tensorflow-cpu>=/g' requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend files (including git history)
COPY . .

# Pull large Keras model via Git LFS
RUN git lfs install
RUN git lfs pull

# Hugging Face Spaces uses port 7860
EXPOSE 7860

# Start FastAPI with uvicorn on port 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]

