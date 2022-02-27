import { Head, useData } from "aleph/react";

type TodoItem = {
  id: number;
  message: string;
  completed: boolean;
};

let todos: TodoItem[] = JSON.parse(window.localStorage?.getItem("todos") || "[]");

export const data = {
  get: (req: Request) => {
    return new Response(JSON.stringify({ todos }));
  },
  put: async (req: Request) => {
    const { message } = await req.json();
    if (typeof message === "string") {
      todos.push({ id: Date.now(), message, completed: false });
      window.localStorage?.setItem("todos", JSON.stringify(todos));
    }
    return new Response(JSON.stringify({ todos }));
  },
  patch: async (req: Request) => {
    const { id, message, completed } = await req.json();
    const todo = todos.find((todo) => todo.id === id);
    if (todo) {
      if (typeof message === "string") {
        todo.message = message;
      }
      if (typeof completed === "boolean") {
        todo.completed = completed;
      }
      window.localStorage?.setItem("todos", JSON.stringify(todos));
    }
    return new Response(JSON.stringify({ todos }));
  },
  delete: (req: Request) => {
    const { searchParams } = new URL(req.url);
    if (searchParams.has("id")) {
      const id = parseInt(searchParams.get("id")!);
      if (!Number.isNaN(id)) {
        todos = todos.filter((todo) => todo.id !== id);
        window.localStorage?.setItem("todos", JSON.stringify(todos));
      }
    }
    return new Response(JSON.stringify({ todos }));
  },
};

export default function Todos() {
  const { data, isMutating, mutation } = useData<{ todos: TodoItem[] }>();

  return (
    <div className="page todos-app">
      <Head>
        <title>Todos App by Aleph.js</title>
      </Head>
      <h1>
        <span>Todos</span>
        {data && data.todos.length > 0 && (
          <em>{data.todos.filter((todo) => todo.completed).length}/{data.todos.length}</em>
        )}
      </h1>
      <ul>
        {data?.todos.map((todo) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => mutation.patch({ id: todo.id, completed: !todo.completed }, "replace")}
            />
            <label className={todo.completed ? "completed" : ""}>{todo.message}</label>
            {todo.id > 0 && <button onClick={() => mutation.delete({ id: todo.id.toString() }, "replace")}></button>}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          const message = fd.get("message")?.toString().trim();
          if (message) {
            mutation.put({ message }, {
              // optimistic update without waiting for the server response
              optimisticUpdate: (data) => {
                return {
                  todos: [...data.todos, { id: 0, message, completed: false }],
                };
              },
              // replace the data with the new data from the server
              replace: true,
            });
            form.reset();
          }
        }}
      >
        <input
          type="text"
          name="message"
          placeholder="What needs to be done?"
          autoFocus
          disabled={!!isMutating}
        />
      </form>
    </div>
  );
}
