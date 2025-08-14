import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnableParallel, RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
import re
import logging
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from flask_cors import CORS
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for browser extension

# Global variables to store the RAG chain and video data
rag_chain = None
current_video_id = None
vector_store = None

def extract_video_id(url):
    """Extract video ID from YouTube URL"""
    patterns = [
        r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([^&\n?#]+)',
        r'youtube\.com/watch\?.*v=([^&\n?#]+)'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def check_video_availability(video_id):
    """Check if video exists and is accessible"""
    try:
        # Try to access YouTube video page
        response = requests.head(f'https://www.youtube.com/watch?v={video_id}', timeout=10)
        return response.status_code == 200
    except:
        return False

def get_youtube_transcript(video_id):
    """Fetch YouTube transcript with comprehensive error handling"""
    try:
        logger.info(f"Attempting to fetch transcript for video: {video_id}")
        
        # First, check if video exists
        if not check_video_availability(video_id):
            raise Exception("Video not found or not accessible. Please check the video ID.")
        
        # Method 1: Try to get English transcript directly
        try:
            transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['en'])
            transcript = " ".join([item['text'] for item in transcript_list])
            logger.info(f"Successfully retrieved English transcript: {len(transcript)} characters")
            return transcript
        except Exception as e:
            logger.info(f"English transcript not available: {str(e)}")
        
        # Method 2: Try to get transcript in any available language
        try:
            transcript_list_obj = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Try manually created transcripts first
            for transcript in transcript_list_obj:
                if not transcript.is_generated:
                    try:
                        transcript_data = transcript.fetch()
                        transcript_text = " ".join([item['text'] for item in transcript_data])
                        logger.info(f"Retrieved manual transcript in {transcript.language}: {len(transcript_text)} characters")
                        return transcript_text
                    except Exception as e:
                        logger.info(f"Failed to fetch manual transcript in {transcript.language}: {str(e)}")
                        continue
            
            # If no manual transcripts, try auto-generated ones
            for transcript in transcript_list_obj:
                if transcript.is_generated:
                    try:
                        transcript_data = transcript.fetch()
                        transcript_text = " ".join([item['text'] for item in transcript_data])
                        logger.info(f"Retrieved auto-generated transcript in {transcript.language}: {len(transcript_text)} characters")
                        return transcript_text
                    except Exception as e:
                        logger.info(f"Failed to fetch auto-generated transcript in {transcript.language}: {str(e)}")
                        continue
                        
        except NoTranscriptFound:
            raise Exception("No transcripts are available for this video. This video may not have captions or subtitles.")
        except TranscriptsDisabled:
            raise Exception("Transcripts are disabled for this video by the video owner.")
        except Exception as e:
            logger.error(f"Error listing transcripts: {str(e)}")
            raise Exception(f"Unable to access transcripts for this video: {str(e)}")
        
        # If we get here, no transcripts were successfully retrieved
        raise Exception("No accessible transcripts found for this video. The video may not have captions enabled.")
        
    except Exception as e:
        logger.error(f"Transcript fetch failed for video {video_id}: {str(e)}")
        raise e

def create_rag_chain(transcript):
    """Create RAG chain from transcript"""
    try:
        # Check if OpenAI API key is set
        if not os.getenv('OPENAI_API_KEY'):
            raise Exception("OpenAI API key is not set. Please set the OPENAI_API_KEY environment variable.")
        
        # Check if transcript is meaningful
        if len(transcript.strip()) < 50:
            raise Exception("Transcript is too short to create a meaningful chat experience.")
        
        # Clean up transcript
        transcript = transcript.replace('\n', ' ').strip()
        
        # Text splitting
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, 
            chunk_overlap=200,
            separators=[". ", "! ", "? ", "\n\n", "\n", ",", " "]
        )
        chunks = splitter.create_documents([transcript])
        
        if not chunks:
            raise Exception("Failed to create text chunks from transcript.")
        
        logger.info(f"Created {len(chunks)} text chunks from transcript")
        
        # Create embeddings and vector store
        embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
        vector_store = FAISS.from_documents(chunks, embeddings)
        
        # Create retriever
        retriever = vector_store.as_retriever(
            search_type="similarity", 
            search_kwargs={"k": 4}
        )
        
        # Create LLM
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.2)
        
        # Create prompt template
        prompt = PromptTemplate(
            template="""You are a helpful assistant that answers questions about a YouTube video based on its transcript.

Use the following transcript context to answer the question. Be specific and cite relevant parts when possible.
If the context doesn't contain enough information to answer the question, say so clearly.

Context from video transcript:
{context}

Question: {question}

Provide a helpful and accurate answer based on the transcript:""",
            input_variables=['context', 'question']
        )
        
        # Helper function to format docs
        def format_docs(retrieved_docs):
            return "\n\n".join(doc.page_content for doc in retrieved_docs)
        
        # Create parallel chain
        parallel_chain = RunnableParallel({
            'context': retriever | RunnableLambda(format_docs),
            'question': RunnablePassthrough()
        })
        
        # Create parser
        parser = StrOutputParser()
        
        # Create main chain
        main_chain = parallel_chain | prompt | llm | parser
        
        return main_chain, vector_store
        
    except Exception as e:
        raise Exception(f"Error creating RAG chain: {str(e)}")

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy", 
        "message": "Flask RAG backend is running",
        "openai_key_set": bool(os.getenv('OPENAI_API_KEY')),
        "youtube_transcript_api_available": True
    })

@app.route('/debug_video', methods=['POST'])
def debug_video():
    """Debug endpoint to check video transcript availability"""
    try:
        data = request.get_json()
        video_url = data.get('video_url')
        
        if not video_url:
            return jsonify({"error": "video_url is required"}), 400
            
        video_id = extract_video_id(video_url)
        if not video_id:
            return jsonify({"error": "Invalid YouTube URL"}), 400
        
        debug_info = {
            "video_id": video_id,
            "video_url": video_url,
            "video_accessible": check_video_availability(video_id),
            "available_transcripts": []
        }
        
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            for transcript in transcript_list:
                debug_info["available_transcripts"].append({
                    "language": transcript.language,
                    "language_code": transcript.language_code,
                    "is_generated": transcript.is_generated,
                    "is_translatable": transcript.is_translatable
                })
        except Exception as e:
            debug_info["transcript_error"] = str(e)
        
        return jsonify(debug_info)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/process_video', methods=['POST'])
def process_video():
    """Process a YouTube video and create RAG chain"""
    global rag_chain, current_video_id, vector_store
    
    try:
        data = request.get_json()
        
        if not data or 'video_url' not in data:
            return jsonify({"error": "video_url is required"}), 400
        
        video_url = data['video_url']
        video_id = extract_video_id(video_url)
        
        if not video_id:
            return jsonify({"error": "Invalid YouTube URL"}), 400
        
        # Check if it's the same video
        if current_video_id == video_id and rag_chain is not None:
            return jsonify({
                "message": "Video already processed",
                "video_id": video_id,
                "status": "ready"
            })
        
        logger.info(f"Processing video: {video_id}")
        
        # Get transcript
        transcript = get_youtube_transcript(video_id)
        logger.info(f"Retrieved transcript with {len(transcript)} characters")
        
        # Create RAG chain
        rag_chain, vector_store = create_rag_chain(transcript)
        current_video_id = video_id
        
        return jsonify({
            "message": "Video processed successfully",
            "video_id": video_id,
            "transcript_length": len(transcript),
            "chunks_created": len(vector_store.index_to_docstore_id) if vector_store else 0,
            "status": "ready"
        })
        
    except Exception as e:
        logger.error(f"Error processing video: {str(e)}")
        
        # Provide more specific error messages
        error_message = str(e)
        if "No transcripts are available" in error_message:
            error_message += " Try a different video that has captions/subtitles enabled."
        elif "Transcripts are disabled" in error_message:
            error_message += " The video owner has disabled captions for this video."
        elif "Video not found" in error_message:
            error_message += " Please check that the YouTube video URL is correct and accessible."
            
        return jsonify({"error": error_message}), 500

@app.route('/ask', methods=['POST'])
def ask_question():
    """Ask a question about the processed video"""
    global rag_chain, current_video_id
    
    try:
        if rag_chain is None:
            return jsonify({"error": "No video processed yet. Please process a video first."}), 400
        
        data = request.get_json()
        
        if not data or 'question' not in data:
            return jsonify({"error": "question is required"}), 400
        
        question = data['question']
        
        if not question.strip():
            return jsonify({"error": "Question cannot be empty"}), 400
        
        logger.info(f"Answering question for video {current_video_id}: {question}")
        
        # Get answer from RAG chain
        answer = rag_chain.invoke(question)
        
        return jsonify({
            "question": question,
            "answer": answer,
            "video_id": current_video_id
        })
        
    except Exception as e:
        logger.error(f"Error answering question: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/get_video_info', methods=['GET'])
def get_video_info():
    """Get information about the currently processed video"""
    global current_video_id, vector_store
    
    if current_video_id is None:
        return jsonify({"error": "No video processed yet"}), 400
    
    try:
        info = {
            "video_id": current_video_id,
            "status": "ready" if rag_chain is not None else "not_ready",
            "chunks_count": len(vector_store.index_to_docstore_id) if vector_store else 0
        }
        
        return jsonify(info)
        
    except Exception as e:
        logger.error(f"Error getting video info: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/reset', methods=['POST'])
def reset():
    """Reset the current session"""
    global rag_chain, current_video_id, vector_store
    
    rag_chain = None
    current_video_id = None
    vector_store = None
    
    return jsonify({"message": "Session reset successfully"})

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Check for OpenAI API key
    if not os.getenv('OPENAI_API_KEY'):
        logger.warning("OPENAI_API_KEY environment variable not set")
        print("⚠️  OPENAI_API_KEY environment variable not set")
        print("   Please set it with: export OPENAI_API_KEY='your-api-key-here'")
    else:
        logger.info("✅ OpenAI API key is configured")
    
    # Check youtube-transcript-api version
    try:
        import youtube_transcript_api
        print(f"📺 youtube-transcript-api version: {youtube_transcript_api.__version__}")
    except:
        print("📺 youtube-transcript-api version: unknown")
    
    print("🚀 Starting Flask server...")
    print("🌐 Server will be available at: http://localhost:5000")
    
    app.run(debug=True, host='0.0.0.0', port=5000)