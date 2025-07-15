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


# CMD ["sh", "-c", "npm i && npm run dev"]
RUN npm i

CMD ["npm", "run", "dev"]