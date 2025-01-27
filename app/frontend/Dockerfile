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
    npm install -g serve && \
    rm -rf /var/cache/apk/*

EXPOSE 3000
WORKDIR /frontend

COPY . /frontend

# Install deps
RUN npm i

# Define a build-time argument (default is 'development')
ARG BUILD_ENV=development

# Run production build if BUILD_ENV=production
RUN if [ "$BUILD_ENV" = "production" ]; then \
      npm run build && \
      echo "✅ Production build completed"; \
    else \
      echo "⚙️  Skipping production build"; \
    fi

# Default command (for dev mode)
CMD ["npm", "run", "dev"]