from typing import List
from langchain_chroma import Chroma
from langchain_core.embeddings import Embeddings
from langchain_core.vectorstores import VectorStore
from langchain_ollama import OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
import pymupdf
import os

from pdf import get_doc_handle, parse_paper

def create_vector_handle(
    embedding_model: Embeddings,
    collection_name: str,
    persistant_dir: str
) -> Chroma:
    """Get a Chroma DB vector handle (this would be used as application wise)"""

    return Chroma(
        embedding_function=embedding_model,
        collection_name=collection_name,
        persist_directory=persistant_dir
    )

def build_index(
    vector_store: VectorStore, # The vector store handle (application wise)
    id: str,
    paper_title: str,
    pdf_path: str | None = None,
    pdf_content: bytes | None = None
) -> int:
    """Parse, chunk in vector form and store Research Paper in Chroma DB"""
    
    pdf_document: pymupdf.Document

    if pdf_path:
        pdf_document = get_doc_handle(pdf_path=pdf_path)
    else:
        pdf_document = get_doc_handle(stream=pdf_content)

    content = parse_paper(pdf_document)
    document: Document = Document(
        page_content=f"Authors and Affiliations of paper `{paper_title}`\n{content}",
        metadata={
            "source": "user",
            "name": paper_title,
            "id": id
        }
    )
    text_splitter: RecursiveCharacterTextSplitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200
    )
    splitted_chunks: List[Document] = text_splitter.split_documents(list([document]))
    ids = [f"{id}--{i}" for i in range(len(splitted_chunks))]
    
    vector_store.add_documents(documents=splitted_chunks, ids=ids)

    return len(splitted_chunks)
