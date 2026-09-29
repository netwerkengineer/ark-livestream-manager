#!/usr/bin/env python3
"""
Knipt een kort fragment uit een eigen YouTube-video en maakt er een
verticale clip van (beeld gecentreerd op een vervaagde achtergrond),
klaar om te uploaden als "video-hoogtepunt" via het ArkChurch-beheerpaneel.

Gebruik:
    python3 extract_youtube_clip.py <youtube_url> <start> <eind> [-o bestandsnaam.mp4]

Tijden in HH:MM:SS, MM:SS of seconden, bijvoorbeeld:
    python3 extract_youtube_clip.py https://youtu.be/xxxxxxxx 12:30 12:55 -o highlight1.mp4

Vereist: yt-dlp en ffmpeg (beide al geïnstalleerd via Homebrew op deze Mac).
"""
import argparse
import os
import subprocess
import sys
import tempfile

VERTICAL_FILTER = (
    "[0:v]split=2[bg][fg];"
    "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
    "crop=1080:1920,boxblur=20:1[bg];"
    "[fg]scale=1080:-2[fg];"
    "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]"
)


def parse_time(value: str) -> float:
    parts = value.split(":")
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + float(part)
    return seconds


def main():
    parser = argparse.ArgumentParser(description="Knip een verticale highlight-clip uit een YouTube-video.")
    parser.add_argument("url", help="YouTube-video-URL")
    parser.add_argument("start", help="Starttijd (bijv. 12:30 of 750)")
    parser.add_argument("end", help="Eindtijd (bijv. 12:55 of 775)")
    parser.add_argument("-o", "--output", default="clip.mp4", help="Bestandsnaam voor de output (default: clip.mp4)")
    args = parser.parse_args()

    start_sec = parse_time(args.start)
    end_sec = parse_time(args.end)
    duration = end_sec - start_sec
    if duration <= 0:
        print("Eindtijd moet na de starttijd liggen.")
        sys.exit(1)
    if duration > 90:
        answer = input(f"Let op: clip is {duration:.0f} seconden, best lang voor een highlight. Toch doorgaan? [y/N] ")
        if answer.strip().lower() != "y":
            sys.exit(0)

    with tempfile.TemporaryDirectory() as tmp:
        raw_path = os.path.join(tmp, "source.mp4")
        print("Downloaden van YouTube...")
        subprocess.run(
            [
                "yt-dlp",
                "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "-o", raw_path,
                args.url,
            ],
            check=True,
        )

        print(f"Fragment knippen ({args.start} - {args.end}) en verticaal maken...")
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(start_sec),
                "-i", raw_path,
                "-t", str(duration),
                "-filter_complex", VERTICAL_FILTER,
                "-map", "[v]",
                "-map", "0:a?",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-c:a", "aac", "-b:a", "128k",
                args.output,
            ],
            check=True,
        )

    print(f"\nKlaar: {args.output}")
    print("Upload dit bestand via het beheerpaneel: Vrije Blokken -> Media Bestand of URL -> upload.")


if __name__ == "__main__":
    main()
