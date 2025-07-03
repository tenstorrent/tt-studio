FROM node:22-alpine

WORKDIR /frontend

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

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies (this layer gets cached when only source code changes)
RUN npm i

# Copy the rest of the application code
COPY . .

CMD ["npm", "run", "dev"]