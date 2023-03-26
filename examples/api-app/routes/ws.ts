export const GET = (req: Request) => {
  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.onopen = () => {
    socket.send("hello");
    console.log("socket opened");
  };
  socket.onmessage = (event) => {
    console.log("socket message", event);
    socket.send(event.data);
  };
  return response;
};
