FROM alpine:3.18 AS builder
RUN apk add --no-cache gcc musl-dev git make sed
WORKDIR /build
RUN git clone https://github.com/pmaillot/X32-Behringer.git .
RUN sed -i 's/getaddrinfo(Xip_str, Xport_str,/getaddrinfo("0.0.0.0", Xport_str,/g' X32.c
RUN cd X32lib && make
RUN gcc -IX32lib -LX32lib -O3 -o X32 X32.c -lX32 -lm -lpthread

FROM alpine:3.18
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=builder /build/X32 .
EXPOSE 10023/udp
CMD ["./X32", "-i", "192.168.2.222", "-v", "1"]


