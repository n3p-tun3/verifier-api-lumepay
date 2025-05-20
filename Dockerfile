# Use a Node base image
FROM node:20

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install

# Copy the rest of the app
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the app
RUN pnpm build

# Expose and start the app
EXPOSE 3001
CMD ["pnpm", "start"]
