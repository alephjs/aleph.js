<script setup>
import { Head, useData } from "aleph/vue"

const { data, isMutating, mutation } = useData();

async function onChange(todo) {
  const { id } = todo;
  const completed = !todo.completed;
  mutation.patch({ id, completed }, "replace")
}

async function onSubmit(e) {
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
    setTimeout(() => {
      form.querySelector("input")?.focus();
    }, 0);
  }
}

function onClick(todo) {
  mutation.delete({ id: todo.id }, "replace");
}
</script>

<script>
const storage = {
  todos: JSON.parse(window.localStorage?.getItem("todos") || "[]"),
};

export const data = {
  cacheTtl: 0,
  get: (_req, ctx) => {
    return ctx.json(storage);
  },
  put: async (req, ctx) => {
    const { message } = await req.json();
    if (typeof message === "string") {
      const id = Date.now();
      storage.todos.push({ id, message, completed: false });
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
</script>

<template>
  <div className="page todos-app">
    <Head>
      <title>Todos</title>
      <meta name="description" content="A todos app powered by Aleph.js" />
    </Head>
    <h1>
      <span>Todos</span>
    </h1>
    <ul>
      <li v-for="todo in data.todos" :key="todo.id">
        <input type="checkbox" :checked="todo.completed" @change="onChange(todo)" />
        <label :class="todo.completed ? 'completed' : ''">{{ todo.message }}</label>
        <button @click="onClick(todo)"></button>
      </li>
    </ul>
    <form @submit="onSubmit">
      <input :disabled="!!isMutating" type="text" name="message" placeholder="What needs to be done?"
        autofocus="autofocus" autocomplete="off" />
    </form>
  </div>
</template>
