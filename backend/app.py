from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnableParallel, RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
import logging

app = Flask(__name__)
CORS(app)  # Enable CORS for Chrome extension

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Store processed videos in memory (you might want to use Redis or a database in production)
processed_videos = {}

# Initialize OpenAI components
def initialize_rag_components():
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.2)
    
    prompt = PromptTemplate(
        template="""
          You are a helpful assistant.
          Answer ONLY from the provided transcript context.
          If the context is insufficient, just say you don't know.

          {context}
          Question: {question}
        """,
        input_variables=['context', 'question']
    )
    
    return embeddings, llm, prompt

embeddings, llm, prompt = initialize_rag_components()

def format_docs(retrieved_docs):
    context_text = "\n\n".join(doc.page_content for doc in retrieved_docs)
    return context_text

def process_video_transcript(video_id):
    """Process video transcript and create RAG chain"""
    try:
        # Get transcript
        ytt_api = YouTubeTranscriptApi()
        transcript_list = ytt_api.fetch(video_id, languages=["en"])
        
        # Flatten to plain text
        transcript = " ".join(chunk.text for chunk in transcript_list)
        
        # Split text
        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        chunks = splitter.create_documents([transcript])
        
        # Create vector store
        vector_store = FAISS.from_documents(chunks, embeddings)
        retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 4})
        
        # Create RAG chain
        parallel_chain = RunnableParallel({
            'context': retriever | RunnableLambda(format_docs),
            'question': RunnablePassthrough()
        })
        
        parser = StrOutputParser()
        main_chain = parallel_chain | prompt | llm | parser
        
        return {
            'chain': main_chain,
            'transcript_length': len(transcript),
            'chunks_count': len(chunks),
            'processed_at': str(pd.Timestamp.now())
        }
        
    except TranscriptsDisabled:
        raise Exception("No captions available for this video")
    except Exception as e:
        raise Exception(f"Error processing video: {str(e)}")

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "message": "YouTube Chatbot API is running"})

@app.route('/process-video', methods=['POST'])
def process_video():
    """Process a YouTube video and prepare it for chatting"""
    try:
        data = request.get_json()
        video_id = data.get('video_id')
        
        if not video_id:
            return jsonify({"success": False, "error": "video_id is required"}), 400
        
        # Check if already processed
        if video_id in processed_videos:
            return jsonify({
                "success": True, 
                "message": "Video already processed",
                "video_id": video_id,
                "transcript_length": processed_videos[video_id]['transcript_length'],
                "chunks_count": processed_videos[video_id]['chunks_count']
            })
        
        logger.info(f"Processing video: {video_id}")
        
        # Process the video
        result = process_video_transcript(video_id)
        processed_videos[video_id] = result
        
        return jsonify({
            "success": True,
            "message": "Video processed successfully",
            "video_id": video_id,
            "transcript_length": result['transcript_length'],
            "chunks_count": result['chunks_count']
        })
        
    except Exception as e:
        logger.error(f"Error processing video: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/chat', methods=['POST'])
def chat():
    """Chat with a processed video"""
    try:
        data = request.get_json()
        video_id = data.get('video_id')
        question = data.get('question')
        
        if not video_id or not question:
            return jsonify({"success": False, "error": "video_id and question are required"}), 400
        
        # Check if video is processed
        if video_id not in processed_videos:
            # Try to process it automatically
            try:
                result = process_video_transcript(video_id)
                processed_videos[video_id] = result
                logger.info(f"Auto-processed video: {video_id}")
            except Exception as e:
                return jsonify({
                    "success": False, 
                    "error": f"Video not processed and auto-processing failed: {str(e)}"
                }), 400
        
        # Get the RAG chain
        chain = processed_videos[video_id]['chain']
        
        # Generate response
        logger.info(f"Answering question for video {video_id}: {question}")
        response = chain.invoke(question)
        
        return jsonify({
            "success": True,
            "response": response,
            "video_id": video_id,
            "question": question
        })
        
    except Exception as e:
        logger.error(f"Error in chat: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/video-info', methods=['GET'])
def get_video_info():
    """Get information about processed videos"""
    video_id = request.args.get('video_id')
    
    if video_id:
        if video_id in processed_videos:
            info = processed_videos[video_id].copy()
            info.pop('chain', None)  # Remove chain object from response
            return jsonify({"success": True, "video_info": info})
        else:
            return jsonify({"success": False, "error": "Video not found"}), 404
    else:
        # Return list of all processed videos
        videos_info = {}
        for vid_id, data in processed_videos.items():
            info = data.copy()
            info.pop('chain', None)  # Remove chain object
            videos_info[vid_id] = info
        
        return jsonify({
            "success": True, 
            "processed_videos": videos_info,
            "count": len(videos_info)
        })

@app.route('/clear-cache', methods=['POST'])
def clear_cache():
    """Clear processed videos cache"""
    global processed_videos
    count = len(processed_videos)
    processed_videos = {}
    
    return jsonify({
        "success": True,
        "message": f"Cleared {count} processed videos from cache"
    })

if __name__ == '__main__':
    # Check for OpenAI API key
    if not os.getenv('OPENAI_API_KEY'):
        logger.error("OPENAI_API_KEY environment variable is required")
        exit(1)
    
    logger.info("Starting YouTube Chatbot API server...")
    app.run(debug=True, host='0.0.0.0', port=5000)