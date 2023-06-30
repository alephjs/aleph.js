/** @format */

import type { FormEvent } from "react";
import { Head, useData } from "aleph/react";

type Todo = {
  id: number;
  message: string;
  completed: boolean;
};

const store = {
  todos: JSON.parse(window.localStorage?.getItem("todos") || "[]") as Todo[],
  save() {
    localStorage?.setItem("todos", JSON.stringify(this.todos));
  },
};

export const data = () => {
  return Response.json(store);
};

export async function mutation(req: Request): Promise<Response> {
  const { id, message, completed } = await req.json();
  switch (req.method) {
    case "PUT": {
      store.todos.push({ id: Date.now(), message, completed: false });
      store.save();
      break;
    }
    case "PATCH": {
      const todo = store.todos.find((todo) => todo.id === id);
      if (todo) {
        todo.completed = completed;
        store.save();
      }
      break;
    }
    case "DELETE": {
      store.todos = store.todos.filter((todo) => todo.id !== id);
      store.save();
    }
  }
  return Response.json(store);
}

export default function Todos() {
  const {
    data: { todos },
    isMutating,
    mutation,
  } = useData<{ todos: Todo[] }>();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const message = fd.get("message")?.toString().trim();
    if (message) {
      await mutation.put(
        { message },
        {
          // optimistic update data without waiting for the server response
          optimisticUpdate: (data) => {
            return {
              todos: [
                ...data.todos,
                { id: 0, message, completed: false },
              ],
            };
          },
          // replace the data with the new data that is from the server response
          replace: true,
        },
      );
      setTimeout(() => form.querySelector("input")?.focus(), 0);
      form.reset();
    }
  };

  return (
    <div className="todos-app">
      <Head>
        <title>Todos</title>
        <meta
          name="description"
          content="A todos app powered by Aleph.js"
        />
      </Head>
      <h1>
        <span>Todos</span>
        {todos.length > 0 && (
          <em>
            {todos.filter((todo) => todo.completed).length}/
            {todos.length}
          </em>
        )}
      </h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() =>
                mutation.patch(
                  { id: todo.id, completed: !todo.completed },
                  "replace",
                )}
            />
            <label className={todo.completed ? "completed" : ""}>
              {todo.message}
            </label>
            {todo.id > 0 && (
              <button
                onClick={() => mutation.delete({ id: todo.id }, "replace")}
              >
                <svg
                  viewBox="0 0 32 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M17.2533 15.9999L24.6221 8.63106C24.7678 8.46101 24.8439 8.24228 24.8352 8.01857C24.8266 7.79485 24.7338 7.58264 24.5755 7.42434C24.4172 7.26603 24.205 7.17329 23.9813 7.16465C23.7576 7.15601 23.5389 7.2321 23.3688 7.37773L15.9999 14.7466L8.63103 7.36884C8.46365 7.20146 8.23663 7.10742 7.99992 7.10742C7.76321 7.10742 7.53619 7.20146 7.36881 7.36884C7.20143 7.53622 7.1074 7.76324 7.1074 7.99995C7.1074 8.23666 7.20143 8.46368 7.36881 8.63106L14.7466 15.9999L7.36881 23.3688C7.27576 23.4485 7.20019 23.5466 7.14683 23.6569C7.09348 23.7671 7.0635 23.8873 7.05877 24.0097C7.05404 24.1321 7.07467 24.2542 7.11936 24.3682C7.16404 24.4823 7.23183 24.5859 7.31846 24.6725C7.40508 24.7592 7.50868 24.8269 7.62275 24.8716C7.73681 24.9163 7.85889 24.9369 7.9813 24.9322C8.10372 24.9275 8.22384 24.8975 8.33412 24.8441C8.4444 24.7908 8.54246 24.7152 8.62214 24.6222L15.9999 17.2533L23.3688 24.6222C23.5389 24.7678 23.7576 24.8439 23.9813 24.8352C24.205 24.8266 24.4172 24.7339 24.5755 24.5756C24.7338 24.4173 24.8266 24.205 24.8352 23.9813C24.8439 23.7576 24.7678 23.5389 24.6221 23.3688L17.2533 15.9999Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit}>
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
