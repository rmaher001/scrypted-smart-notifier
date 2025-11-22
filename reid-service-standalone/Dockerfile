FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app.py .
COPY reid_engine.py .

# Expose port
EXPOSE 8765

# Resource limits are set via docker run --cpus and --memory
CMD ["python", "app.py"]
