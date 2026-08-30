FROM node:22-alpine

WORKDIR /site
RUN chown node:node /site
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start", "--", "--host", "0.0.0.0", "--port", "3000"]
