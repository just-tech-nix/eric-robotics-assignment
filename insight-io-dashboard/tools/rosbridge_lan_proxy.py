import asyncio

LISTEN_HOST = '0.0.0.0'
LISTEN_PORT = 9091
TARGET_HOST = '127.0.0.1'
TARGET_PORT = 9090

async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while not reader.at_eof():
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

async def handle_client(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    try:
        target_reader, target_writer = await asyncio.open_connection(TARGET_HOST, TARGET_PORT)
    except Exception:
        client_writer.close()
        await client_writer.wait_closed()
        return

    await asyncio.gather(
        pipe(client_reader, target_writer),
        pipe(target_reader, client_writer),
        return_exceptions=True,
    )

async def main():
    server = await asyncio.start_server(handle_client, LISTEN_HOST, LISTEN_PORT)
    sockets = ', '.join(str(sock.getsockname()) for sock in (server.sockets or []))
    print(f'ROS bridge LAN proxy listening on {sockets} -> {TARGET_HOST}:{TARGET_PORT}', flush=True)
    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main())
