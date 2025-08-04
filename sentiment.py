#!/usr/bin/env python3
import sys
import re
import os
import requests

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv not available, use os.environ directly
    pass

def clean_text(text):
    """Clean text for sentiment analysis while preserving structure"""
    # Remove code blocks but keep other content
    text = re.sub(r'```[\s\S]*?```', '[CODE_BLOCK]', text)  # Replace with placeholder
    text = re.sub(r'`[^`]*`', '[CODE]', text)  # Replace inline code
    text = re.sub(r'https?://\S+', '[URL]', text)  # Replace URLs with placeholder
    text = re.sub(r'\s+', ' ', text)  # Normalize whitespace
    return text.strip()

def split_into_chunks(text, max_tokens=300, overlap_tokens=50):
    """
    Split text into overlapping chunks to preserve context
    """
    words = text.split()
    chunks = []

    if len(words) <= max_tokens:
        return [text]

    start = 0
    while start < len(words):
        end = min(start + max_tokens, len(words))
        chunk = ' '.join(words[start:end])
        chunks.append(chunk)

        # If this is the last chunk, break
        if end >= len(words):
            break

        # Move start position back by overlap amount for next chunk
        start = end - overlap_tokens

    return chunks

def analyze_chunk_with_huggingface(text):
    """Analyze a single chunk using Hugging Face"""
    try:
        hf_token = os.getenv('HF_TOKEN')
        if not hf_token:
            return None

        headers = {"Authorization": f"Bearer {hf_token}"}
        response = requests.post(
            "https://api-inference.huggingface.co/models/nlptown/bert-base-multilingual-uncased-sentiment",
            headers=headers,
            json={"inputs": text},
            timeout=5
        )

        if response.status_code == 200:
            result = response.json()
            if isinstance(result, list) and len(result) > 0:
                scores = result[0]
                if isinstance(scores, list):
                    # Convert 1-5 star ratings to -1 to 1 scale
                    best_score = max(scores, key=lambda x: x['score'])


                    if best_score['label'] in ['5 stars', '4 stars']:
                        return best_score['score']
                    elif best_score['label'] in ['1 star', '2 stars']:
                        return -best_score['score']
                    else:  # 3 stars (neutral)
                        return 0

        else:
            return None

    except Exception:
        return None

def analyze_with_chunking(text):
    """
    Analyze sentiment by processing text in chunks and aggregating results
    """
    cleaned_text = clean_text(text)
    chunks = split_into_chunks(cleaned_text, max_tokens=300, overlap_tokens=50)


    chunk_sentiments = []
    chunk_weights = []  # Weight chunks by their length

    for chunk in chunks:
        sentiment = analyze_chunk_with_huggingface(chunk)
        if sentiment is not None:
            chunk_sentiments.append(sentiment)
            chunk_weights.append(len(chunk.split()))  # Weight by word count

    if not chunk_sentiments:
        return None

    # Calculate weighted average sentiment
    if len(chunk_sentiments) == 1:
        final_sentiment = chunk_sentiments[0]
    else:
        # Weighted average based on chunk length
        weighted_sum = sum(sentiment * weight for sentiment, weight in zip(chunk_sentiments, chunk_weights))
        total_weight = sum(chunk_weights)
        final_sentiment = weighted_sum / total_weight


    return final_sentiment


def main():
    text = sys.stdin.read().strip()

    if not text:
        print(0)
        return

    if len(text) < 10:  # Too short for meaningful analysis
        print(0)
        return

    # Analyze sentiment using Hugging Face
    sentiment = analyze_with_chunking(text)

    # Ensure we output a valid number
    if sentiment is None or str(sentiment).lower() == 'nan':
        sentiment = 0

    # Clamp sentiment to reasonable bounds (-1 to 1)
    sentiment = max(-1, min(1, sentiment))

    print(sentiment)

if __name__ == "__main__":
    main()