FROM alpine:3.18 AS builder
RUN apk add --no-cache gcc musl-dev git make
WORKDIR /build
RUN git clone https://github.com/pmaillot/X32-Behringer.git .
RUN cd X32lib && make
RUN gcc -IX32lib -LX32lib -O3 -o X32 X32.c -lX32 -lm -lpthread

FROM alpine:3.18
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=builder /build/X32 .
EXPOSE 10023/udp
CMD ["./X32", "-i", "0.0.0.0", "-v", "1"]


