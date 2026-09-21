from typing import List, Tuple
from langchain_chroma import Chroma
import uuid
from langchain_core.documents import Document
from uuid_utils import uuid7

from utils import Config, load_config
from vector_store import build_index, create_vector_handle

def _search_documentation(
    query: str, 
    vector_store: Chroma
) -> str:
        """
        Search through indexed PDF and save the retrieved chunks to the agent's filesystem

        Args:
            query: Natural language search query.

        Returns:
            All the retrieved chunks combined.
        """
        
        retrieved_docs: List[Document] = vector_store.similarity_search(query, k=4)
        
        return "+++\n\n+++\n\n".join(doc.page_content for doc in retrieved_docs)

# Test 1
def test_vector_retrieval_from_db():
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_ollama import OllamaEmbeddings
    import pymupdf
    from pdf import get_doc_handle, parse_paper 

    PDF_PATH: str = "./papers/25C28_IEEE_Format_Research_Paper.pdf"
    PAPER_TITLE: str = "AI Assitant For Disabled"

    embedding_model: OllamaEmbeddings = OllamaEmbeddings(
        model="mxbai-embed-large"
    )
    config: Config = load_config()
    vector_store: Chroma = create_vector_handle(
        embedding_model,
        collection_name=config.chroma_collection_name,
        persistant_dir=config.chroma_persistant_dir
    )
    chunks_created: int = build_index(
        vector_store,
        str(uuid7()),
        PAPER_TITLE,
        pdf_path=PDF_PATH
    )
    
    chunks: str = _search_documentation(
        "Who are the authors of the research paper `AI Assistant For Disabled`?",
        vector_store
    )

    print(f"Chunks: {chunks}\n")
