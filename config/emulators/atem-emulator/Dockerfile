FROM python:3.10-alpine
RUN apk add --no-cache git
WORKDIR /app
RUN git clone https://github.com/jonknoll/pyAtemSim.git .

# Patch atem_commands.py to read product name dynamically from config
RUN sed -i 's/self.product_name = "ATEM Television Studio HD"/self.product_name = atem_config.conf_db.get("product", "ATEM Television Studio HD")/' atem_commands.py

# Patch atem_config.py to add support for ATEM Mini models in DEVICE_VIDEO_SOURCES
RUN sed -i '/"ATEM Television Studio HD" :/i \    "ATEM Mini" : [0,1,2,3,4,1000,2001,2002,3010,3011,4010,5010,5020,10010,10011,7001,7002],\n    "ATEM Mini Pro" : [0,1,2,3,4,1000,2001,2002,3010,3011,4010,5010,5020,10010,10011,7001,7002,8001],\n    "ATEM Mini Extreme" : [0,1,2,3,4,5,6,7,8,1000,2001,2002,3010,3011,3020,3021,4010,5010,5020,10010,10011,7001,7002,8001,8002,6000],' atem_config.py

COPY entrypoint.py .
EXPOSE 9910/udp
CMD ["python", "entrypoint.py"]
