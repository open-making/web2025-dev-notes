#!/usr/bin/env python3
import sys
import re
try:
    from textblob import TextBlob
    
    text = sys.stdin.read().strip()
    if not text:
        print(0)
        sys.exit()
    
    # Clean text: remove code blocks, URLs, and excessive whitespace
    text = re.sub(r'```[\s\S]*?```', ' ', text)  # Remove code blocks
    text = re.sub(r'`[^`]*`', ' ', text)         # Remove inline code
    text = re.sub(r'https?://\S+', ' ', text)   # Remove URLs
    text = re.sub(r'\s+', ' ', text)             # Normalize whitespace
    
    if len(text.strip()) < 3:  # Too short for meaningful analysis
        print(0)
        sys.exit()
    
    blob = TextBlob(text)
    # Apply smoothing: reduce extreme values slightly
    polarity = blob.sentiment.polarity
    smoothed = polarity * 0.8  # Dampen extreme sentiments slightly
    
    print(smoothed)
    
except ImportError:
    print(0)  # textblob not installed
except Exception:
    print(0)