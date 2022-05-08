import { Head, useData } from "aleph/react";

type TodoItem = {
  id: number;
  message: string;
  completed: boolean;
};

type DataProps = {
  todos: TodoItem[];
};

const storage: DataProps = {
  todos: JSON.parse(window.localStorage?.getItem("todos") || "[]"),
};

export const data: Data<DataProps> = {
  cacheTtl: 0,
  get: (_req, ctx) => {
    return ctx.json(storage);
  },
  put: async (req, ctx) => {
    const { message } = await req.json();
    if (typeof message === "string") {
      storage.todos.push({ id: Date.now(), message, completed: false });
      window.localStorage?.setItem("todos", JSON.stringify(storage.todos));
    }
    return ctx.json(storage);
  },
  patch: async (req, ctx) => {
    const { id, message, completed } = await req.json();
    const todo = storage.todos.find((todo) => todo.id === id);
    if (todo) {
      if (typeof message === "string") {
        todo.message = message;
      }
      if (typeof completed === "boolean") {
        todo.completed = completed;
      }
      window.localStorage?.setItem("todos", JSON.stringify(storage.todos));
    }
    return ctx.json(storage);
  },
  delete: async (req, ctx) => {
    const { id } = await req.json();
    if (id) {
      storage.todos = storage.todos.filter((todo) => todo.id !== id);
      window.localStorage?.setItem("todos", JSON.stringify(storage.todos));
    }
    return ctx.json(storage);
  },
};

export default function Todos() {
  const { data: { todos }, isMutating, mutation } = useData<DataProps>();

  return (
    <div className="todos-app">
      <Head>
        <title>Todos</title>
        <meta name="description" content="A todos app powered by Aleph.js" />
      </Head>
      <h1>
        <span>Todos</span>
        {todos.length > 0 && <em>{todos.filter((todo) => todo.completed).length}/{todos.length}</em>}
      </h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => mutation.patch({ id: todo.id, completed: !todo.completed }, "replace")}
            />
            <label className={todo.completed ? "completed" : ""}>{todo.message}</label>
            {todo.id > 0 && <button onClick={() => mutation.delete({ id: todo.id }, "replace")}></button>}
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          const message = fd.get("message")?.toString().trim();
          if (message) {
            await mutation.put({ message }, {
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
            setTimeout(() => {
              form.querySelector("input")?.focus();
            }, 0);
          }
        }}
      >
        <input
          type="text"
          name="message"
          placeholder="What needs to be done?"
          autoFocus
          autoComplete="off"
          disabled={!!isMutating}
        />
      </form>
    </div>
  );
}
