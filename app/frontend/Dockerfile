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

# Conditionally run the production build
RUN if [ "$BUILD_ENV" = "production" ]; then \
      npm run build && \
      echo "✅ Production build completed successfully"; \
    else \
      echo "⚙️  Skipping production build, dev environment assumed"; \
    fi

# Default command -> Dev mode
CMD ["npm", "run", "dev"]
