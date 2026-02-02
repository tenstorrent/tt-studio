# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Response Validator for RAG Answer Scoping

This module provides validation to ensure that LLM responses are grounded in
the provided document context and don't fabricate information.
"""

import re
from typing import List, Dict, Optional, Tuple
from sentence_transformers import SentenceTransformer
import numpy as np
from shared_config.logger_config import get_logger

logger = get_logger(__name__)


class ResponseValidator:
    """
    Validates LLM responses against source documents to ensure grounding.

    This validator performs multiple checks:
    1. Detects proper refusal phrases (which should pass validation)
    2. Checks semantic similarity between response and source documents
    3. Detects hallucination markers (unsupported facts, dates, names)
    """

    # Refusal phrases that indicate proper behavior
    REFUSAL_PHRASES = [
        "i cannot answer this based on the provided documents",
        "i cannot answer this question based on the provided documents",
        "i'm not sure",
        "i don't have enough information",
        "the documents don't contain",
        "not found in the provided documents",
        "insufficient information in the documents",
        "the available documents don't contain",
    ]

    # Patterns that might indicate hallucination
    HALLUCINATION_PATTERNS = [
        r'\b(19|20)\d{2}\b',  # Years (e.g., 2023, 1999)
        r'\b\d{1,2}/\d{1,2}/\d{2,4}\b',  # Dates (e.g., 12/31/2023)
        r'\$\d+(?:,\d{3})*(?:\.\d{2})?',  # Dollar amounts
        r'\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:million|billion|thousand)',  # Large numbers
    ]

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize the validator with a sentence transformer model.

        Args:
            model_name: Name of the sentence transformer model to use for semantic similarity
        """
        self.model_name = model_name
        self._model = None
        logger.info(f"ResponseValidator initialized with model: {model_name}")

    @property
    def model(self) -> SentenceTransformer:
        """Lazy load the sentence transformer model."""
        if self._model is None:
            logger.info(f"Loading sentence transformer model: {self.model_name}")
            self._model = SentenceTransformer(self.model_name)
        return self._model

    def is_refusal(self, response: str) -> bool:
        """
        Check if the response is a proper refusal to answer.

        Args:
            response: The LLM response text

        Returns:
            True if the response contains a refusal phrase
        """
        response_lower = response.lower().strip()

        # Check for refusal phrases
        for phrase in self.REFUSAL_PHRASES:
            if phrase in response_lower:
                logger.info(f"Detected refusal phrase: '{phrase}'")
                return True

        return False

    def compute_semantic_similarity(
        self, response: str, source_documents: List[str]
    ) -> float:
        """
        Compute semantic similarity between response and source documents.

        Args:
            response: The LLM response text
            source_documents: List of source document texts

        Returns:
            Maximum cosine similarity score (0-1, higher is better)
        """
        if not source_documents:
            logger.warning("No source documents provided for similarity check")
            return 0.0

        try:
            # Encode response and documents
            response_embedding = self.model.encode([response], convert_to_numpy=True)
            doc_embeddings = self.model.encode(source_documents, convert_to_numpy=True)

            # Compute cosine similarity with each document
            similarities = []
            for doc_emb in doc_embeddings:
                # Cosine similarity
                similarity = np.dot(response_embedding[0], doc_emb) / (
                    np.linalg.norm(response_embedding[0]) * np.linalg.norm(doc_emb)
                )
                similarities.append(similarity)

            max_similarity = max(similarities) if similarities else 0.0
            logger.info(f"Semantic similarity scores: min={min(similarities):.3f}, max={max_similarity:.3f}, avg={np.mean(similarities):.3f}")

            return float(max_similarity)

        except Exception as e:
            logger.error(f"Error computing semantic similarity: {e}", exc_info=True)
            return 0.0

    def detect_hallucination_markers(
        self, response: str, source_documents: List[str]
    ) -> List[Dict[str, str]]:
        """
        Detect potential hallucination markers in the response.

        This checks for specific facts (dates, numbers, names) in the response
        that don't appear in the source documents.

        Args:
            response: The LLM response text
            source_documents: List of source document texts

        Returns:
            List of detected hallucination markers with type and value
        """
        markers = []

        # Combine all source documents for searching
        combined_sources = " ".join(source_documents).lower()

        # Check for each hallucination pattern
        for pattern in self.HALLUCINATION_PATTERNS:
            matches = re.finditer(pattern, response, re.IGNORECASE)
            for match in matches:
                value = match.group(0)
                # Check if this value appears in source documents
                if value.lower() not in combined_sources:
                    markers.append({
                        "type": "unsupported_fact",
                        "value": value,
                        "pattern": pattern,
                    })
                    logger.warning(f"Potential hallucination detected: '{value}' not found in sources")

        return markers

    def validate_response(
        self,
        response: str,
        source_documents: List[str],
        similarity_threshold: float = 0.3,
        check_hallucinations: bool = True,
    ) -> Tuple[bool, Dict]:
        """
        Validate an LLM response against source documents.

        Args:
            response: The LLM response text
            source_documents: List of source document texts
            similarity_threshold: Minimum semantic similarity required (0-1)
            check_hallucinations: Whether to check for hallucination markers

        Returns:
            Tuple of (is_valid, metadata_dict)
            - is_valid: True if response passes validation
            - metadata_dict: Details about validation checks
        """
        metadata = {
            "is_refusal": False,
            "semantic_similarity": 0.0,
            "hallucination_markers": [],
            "validation_passed": False,
            "failure_reason": None,
        }

        # Check if response is a refusal (which is valid behavior)
        if self.is_refusal(response):
            metadata["is_refusal"] = True
            metadata["validation_passed"] = True
            logger.info("Response is a proper refusal - validation passed")
            return True, metadata

        # Check semantic similarity
        similarity = self.compute_semantic_similarity(response, source_documents)
        metadata["semantic_similarity"] = similarity

        if similarity < similarity_threshold:
            metadata["validation_passed"] = False
            metadata["failure_reason"] = f"Low semantic similarity: {similarity:.3f} < {similarity_threshold}"
            logger.warning(f"Validation failed: {metadata['failure_reason']}")
            return False, metadata

        # Check for hallucination markers if enabled
        if check_hallucinations:
            markers = self.detect_hallucination_markers(response, source_documents)
            metadata["hallucination_markers"] = markers

            if markers:
                metadata["validation_passed"] = False
                metadata["failure_reason"] = f"Detected {len(markers)} potential hallucination(s)"
                logger.warning(f"Validation failed: {metadata['failure_reason']}")
                return False, metadata

        # All checks passed
        metadata["validation_passed"] = True
        logger.info(f"Response validation passed (similarity: {similarity:.3f})")
        return True, metadata

    def generate_refusal_message(
        self,
        original_query: str,
        confidence_level: str = "insufficient",
        filtered_count: int = 0,
        suggestions: Optional[List[str]] = None,
    ) -> str:
        """
        Generate a standardized refusal message.

        Args:
            original_query: The user's original query
            confidence_level: The confidence level from retrieval
            filtered_count: Number of documents that passed filtering
            suggestions: Optional list of suggestions for the user

        Returns:
            Formatted refusal message
        """
        message = "I cannot answer this question based on the provided documents."

        # Add details based on confidence level
        if confidence_level == "insufficient" or filtered_count == 0:
            message += " The available documents don't contain information relevant to your query."
        else:
            message += " The retrieved information has insufficient confidence to provide an accurate answer."

        # Add suggestions
        if suggestions:
            message += "\n\nPlease consider:"
            for suggestion in suggestions:
                message += f"\n• {suggestion}"
        else:
            message += "\n\nPlease consider:"
            message += "\n• Uploading documents that cover this topic"
            message += "\n• Rephrasing your question to match the content in your documents"
            message += "\n• Asking a different question about the topics covered in your uploaded documents"

        return message
