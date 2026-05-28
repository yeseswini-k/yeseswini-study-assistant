import requests
import os
from PIL import Image, ImageDraw

def generate_test_image():
    print("Generating test image...")
    # Create white image
    img = Image.new("RGB", (600, 150), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    # Write test text with some messy/spelling-error patterns to test correction
    d.text((20, 30), "Yeseswinis Al Study Assistant OCR Integration Test.", fill=(0, 0, 0))
    d.text((20, 60), "Thiscontains handwrittn styl notes. Imporlantconcepts: RAG, Multimodal ChromaDB.", fill=(0, 0, 0))
    
    img_path = "ocr_test_image.png"
    img.save(img_path)
    print(f"Test image saved to {img_path}")
    return img_path

def run_tests():
    base_url = "http://localhost:8000"
    img_path = generate_test_image()
    
    # 1. Test Image Upload (OCR Flow with EasyOCR + OpenCV)
    print("\n1. Testing Image Upload to /api/upload...")
    with open(img_path, "rb") as f:
        files = {"files": (img_path, f, "image/png")}
        data = {"chunk_size": 1000, "chunk_overlap": 200}
        response = requests.post(f"{base_url}/api/upload", files=files, data=data)
        
    assert response.status_code == 200, f"Failed upload: {response.text}"
    res_json = response.json()
    print("Upload Response:", res_json)
    
    result = res_json["results"][0]
    assert result["status"] == "ocr_preview_required", "Should require OCR preview for images."
    print(f"OCR successfully extracted text! Confidence: {result['confidence']:.2f}%")
    raw_text = result["text"]
    print("Raw OCR text extracted:\n", raw_text)
    
    # 2. Test AI OCR Correction Layer
    print("\n2. Testing AI OCR Correction via /api/ocr/correct...")
    correct_payload = {"text": raw_text}
    correct_response = requests.post(f"{base_url}/api/ocr/correct", json=correct_payload)
    assert correct_response.status_code == 200, f"Failed correction: {correct_response.text}"
    correct_json = correct_response.json()
    corrected_text = correct_json["corrected_text"]
    print("AI Corrected/Reconstructed text:\n", corrected_text)
    assert len(corrected_text) > 10, "Should return reconstructed text."
    
    # 3. Test Indexing approved text
    print("\n3. Testing indexing corrected text via /api/index-text...")
    index_payload = {
        "filename": "ocr_test_image.png",
        "text": corrected_text + "\n--- Page 1 ---\nAdditional verified content added manually.",
        "chunk_size": 1000,
        "chunk_overlap": 200
    }
    index_response = requests.post(f"{base_url}/api/index-text", json=index_payload)
    assert index_response.status_code == 200, f"Failed indexing: {index_response.text}"
    print("Indexing Response:", index_response.json())
    
    # 4. Test documents list shows the indexed image
    print("\n4. Testing /api/documents list...")
    docs_response = requests.get(f"{base_url}/api/documents")
    assert docs_response.status_code == 200
    docs = docs_response.json()
    print("Documents in system:", [d["filename"] for d in docs])
    assert any(d["filename"] == "ocr_test_image.png" for d in docs), "Uploaded image should be in docs metadata list."
    
    # 5. Test RAG querying the newly uploaded image content
    print("\n5. Testing RAG query for content inside the image...")
    chat_payload = {
        "message": "What is the study assistant OCR test about?",
        "doc_filters": ["ocr_test_image.png"],
        "explanation_mode": "intermediate",
        "history": [],
        "top_k": 4
    }
    chat_response = requests.post(f"{base_url}/api/chat", json=chat_payload)
    assert chat_response.status_code == 200
    
    # Read references and content
    print("\nRAG Results stream:")
    for line in chat_response.iter_lines():
        if line:
            import json
            parsed = json.loads(line.decode("utf-8"))
            if parsed["type"] == "references":
                print("References retrieved:", parsed["data"])
                assert len(parsed["data"]) > 0, "RAG should successfully retrieve the indexed text chunks!"
            elif parsed["type"] == "content":
                print(parsed["data"], end="")
    print("\n\nAll tests passed successfully!")
    
    # Cleanup backend document
    print("\nCleaning up backend document...")
    try:
        del_response = requests.delete(f"{base_url}/api/documents/{img_path}")
        if del_response.status_code == 200:
            print("Successfully cleaned up backend document.")
        else:
            print(f"Backend cleanup returned status code {del_response.status_code}: {del_response.text}")
    except Exception as e:
        print("Failed to clean up backend document:", e)

    # Cleanup local test image
    if os.path.exists(img_path):
        os.remove(img_path)

if __name__ == "__main__":
    run_tests()
