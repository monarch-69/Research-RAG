from typing import Any, Dict, List, cast
import pymupdf

def get_doc_handle(
    pdf_path: str | None = None,
    stream: bytes | None = None
) -> pymupdf.Document:
    return pymupdf.open(pdf_path) if pdf_path else pymupdf.open(stream=stream, filetype="pdf")

def parse_paper_to_dict(document: pymupdf.Document) -> List[Dict]:
    page_wise_content: List[Dict] = []

    try:
        for page in document:
            single_page_content: Dict = cast(Dict[Any, Any], page.get_text("dict"))
            page_wise_content.append(single_page_content)
        return page_wise_content
    finally:
        print("Parse was successful...\n")

def parse_paper(document: pymupdf.Document) -> str:
    content: str = ""
    
    try:
        for page in document:
            content += cast(str, page.get_text("text"))
        return content
    finally:
        print("Parse was successful...\n")

# Requires a Document
def extract_images(document: pymupdf.Document):
    for page_num in range(document.page_count):
        image_list = document[page_num].get_images()
        print(image_list)

def print_pages_from_dict(page_wise_content: List[Dict]):
    for page in page_wise_content:
        for key, value in page.items():
            print(f"Key: {key} and Value: {value}")

# def main() -> None:
#     document: pymupdf.Document = get_doc_handle(
#         "./papers/25C28_IEEE_Format_Research_Paper.pdf"
#     )
#     content: str = parse_paper(document)
#     print(content)
#     extract_images(document)
#
#     document.close()
# main()
