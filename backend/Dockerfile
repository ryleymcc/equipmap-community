FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (needed for compiling some python packages and for psycopg2)
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade "pip>=26.2" "setuptools>=83.0.0" \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

# Create the uploads directory where files will be stored
RUN mkdir -p uploads

EXPOSE 8000

# Command is overridden in docker-compose for dev, but good to have a default
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
