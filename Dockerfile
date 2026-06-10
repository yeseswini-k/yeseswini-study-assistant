FROM python:3.10-slim

# Prevent Python from buffering stdout/stderr (diagnostics will print instantly)
ENV PYTHONUNBUFFERED=1 \
    PORT=7860

WORKDIR /app

# Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the application files
COPY . .

# Create writeable storage directories and set permissions for Hugging Face container user (uid 1000)
RUN mkdir -p /app/backend/uploads /app/app_data /app/backend/chroma_db && \
    chmod -R 777 /app/backend /app/app_data

EXPOSE 7860

# Run uvicorn on port 7860 (Hugging Face default)
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
