FROM node:21-alpine3.18

RUN apk update && \
    apk add --no-cache \
    procps \
    net-tools \
    iputils \
    bind-tools \
    bash \
    curl \
    traceroute && \
    rm -rf /var/cache/apk/*

EXPOSE 3000
WORKDIR /frontend
COPY . /frontend
# RUN apt-get update && apt-get install 
# build
RUN npm i

CMD npm run dev