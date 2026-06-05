FROM python:3.10-alpine
RUN apk add --no-cache git
WORKDIR /app
RUN git clone https://github.com/jonknoll/pyAtemSim.git .
EXPOSE 9910/udp
CMD ["python", "atem_server.py"]
