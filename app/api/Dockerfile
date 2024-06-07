FROM python:3.12.1-slim-bullseye
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# debug tools
RUN apt-get update && \
    apt-get install -y \
    procps \
    net-tools \
    iputils-ping \
    dnsutils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /api
COPY ./requirements.txt /api
RUN pip3 install -r requirements.txt --no-cache-dir
COPY . /api
