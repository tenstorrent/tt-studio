FROM node:22-alpine3.20

RUN apk update && \
    apk upgrade && \
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


# CMD ["sh", "-c", "npm i && npm run dev"]
RUN npm i

CMD ["npm", "run", "dev"]