# Short-link store for Tube Amp CAD's Share link (server.mjs): no packages, only Node itself
FROM node:22-alpine
WORKDIR /app
COPY server.mjs access.mjs revisions.mjs ./
USER node
ENV DATA=/data REVS=/revs PORT=8080
VOLUME /data /revs
EXPOSE 8080
CMD ["node", "server.mjs"]
