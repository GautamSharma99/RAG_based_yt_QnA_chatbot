from youtube_transcript_api import YouTubeTranscriptApi

video_id = "YbJOTdZBX1g"  # replace with your video ID
transcripts = YouTubeTranscriptApi.list_transcripts(video_id)

for t in transcripts:
    print({
        "language": t.language,
        "code": t.language_code,
        "is_generated": t.is_generated,
        "is_translatable": t.is_translatable
    })
