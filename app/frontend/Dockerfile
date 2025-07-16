# Stage 1: Builder - creates the optimized React build
FROM node:22-alpine3.20 AS builder

# Define build arguments for Vite environment variables
ARG VITE_ENABLE_DEPLOYED
ARG VITE_APP_TITLE
ARG VITE_ENABLE_RAG_ADMIN
ARG VITE_TEST_AUDIO_URL
ARG VITE_TEST_AUDIO_AUTH
ARG VITE_LOGIN_USERNAME
ARG VITE_LOGIN_PASSWORD
ARG VITE_LLAMA_AUTH_TOKEN
ARG VITE_SPECIAL_API_URL
ARG VITE_API_HOST
ARG VITE_STABILITY_API_KEY

# Set environment variables from build arguments
ENV VITE_ENABLE_DEPLOYED=$VITE_ENABLE_DEPLOYED
ENV VITE_APP_TITLE=$VITE_APP_TITLE
ENV VITE_ENABLE_RAG_ADMIN=$VITE_ENABLE_RAG_ADMIN
ENV VITE_TEST_AUDIO_URL=$VITE_TEST_AUDIO_URL
ENV VITE_TEST_AUDIO_AUTH=$VITE_TEST_AUDIO_AUTH
ENV VITE_LOGIN_USERNAME=$VITE_LOGIN_USERNAME
ENV VITE_LOGIN_PASSWORD=$VITE_LOGIN_PASSWORD
ENV VITE_LLAMA_AUTH_TOKEN=$VITE_LLAMA_AUTH_TOKEN
ENV VITE_SPECIAL_API_URL=$VITE_SPECIAL_API_URL
ENV VITE_API_HOST=$VITE_API_HOST
ENV VITE_STABILITY_API_KEY=$VITE_STABILITY_API_KEY

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production - serves the static files with Nginx
FROM nginx:alpine AS production

# Copy the built assets from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy our custom Nginx configuration to override the default
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"] 