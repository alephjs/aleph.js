<script>
const store = {
  todos: JSON.parse(window.localStorage?.getItem("todos") || "[]"),
};

export const data = {
  cacheTtl: 0, // no cache
  get: () => {
    return store;
  },
  put: async (req) => {
    const { message } = await req.json();
    if (typeof message === "string") {
      const id = Date.now();
      store.todos.push({ id, message, completed: false });
      window.localStorage?.setItem("todos", JSON.stringify(store.todos));
    }
    return store;
  },
  patch: async (req) => {
    const { id, message, completed } = await req.json();
    const todo = store.todos.find((todo) => todo.id === id);
    if (todo) {
      if (typeof message === "string") {
        todo.message = message;
      }
      if (typeof completed === "boolean") {
        todo.completed = completed;
      }
      window.localStorage?.setItem("todos", JSON.stringify(store.todos));
    }
    return store;
  },
  delete: async (req) => {
    const { id } = await req.json();
    if (id) {
      store.todos = store.todos.filter((todo) => todo.id !== id);
      window.localStorage?.setItem("todos", JSON.stringify(store.todos));
    }
    return store;
  },
};
</script>

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
      // replace the data with the new data that is from the server response
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

<template>
  <div className="todos-app">
    <Head>
      <title>Todos</title>
      <meta name="description" content="A todos app powered by Aleph.js" />
    </Head>
    <h1>
      <span>Todos</span>
    </h1>
    <ul>
      <li v-for="todo in data?.todos" :key="todo.id">
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

<style>
.todos-app {
  width: 90%;
  max-width: 600px;
  margin: 0 auto;
  padding-top: 60px;
}

.todos-app h1 {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px;
  font-size: 48px;
  font-weight: 200;
  text-align: left;
  color: #333;
}

.todos-app h1 em {
  font-size: 24px;
  font-weight: 100;
  color: #ccc;
}

.todos-app ul {
  width: 100%;
  list-style: none;
  margin-bottom: 6px;
}

.todos-app ul li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-radius: 6px;
}

.todos-app ul li:hover {
  background-color: #f9f9f9;
}

.todos-app ul li input {
  position: relative;
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid #ddd;
  border-radius: 10px;
  cursor: pointer;
}

.todos-app ul li input:hover,
.todos-app ul li input:checked {
  border: 1px solid #b8dad4;
}

.todos-app ul li input:checked::after {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background-color: #5dc2af;
  content: " ";
}

.todos-app ul li label {
  line-height: 20px;
  flex-grow: 1;
  font-size: 20px;
  font-weight: 300;
  color: #333;
  transition: color 0.15s ease;
}

.todos-app ul li label.completed {
  color: #aaa;
  text-decoration: line-through;
}

.todos-app ul li button {
  position: relative;
  width: 20px;
  height: 20px;
  overflow: hidden;
  color: #ddd;
  transition: color 0.15s ease;
  cursor: pointer;
}

.todos-app ul li:hover button {
  color: #ccc;
}

.todos-app ul li button:hover {
  color: #c26c5d;
}

.todos-app ul li button:before,
.todos-app ul li button:after {
  content: " ";
  position: absolute;
  left: 10px;
  top: 10px;
  width: 16px;
  height: 1px;
  margin-left: -8px;
  background: currentColor;
}

.todos-app ul li button:before {
  transform: rotate(45deg);
}

.todos-app ul li button:after {
  transform: rotate(-45deg);
}

.todos-app form {
  box-sizing: border-box;
  width: 100%;
  padding: 10px;
}

.todos-app form input {
  display: block;
  width: 100%;
  padding: 6px 12px;
  margin: 0 -12px;
  border-radius: 6px;
  font-size: 24px;
  font-weight: 300;
  color: #333;
}

.todos-app form input:focus{
  background-color: #f9f9f9;
  outline: none;
}

.todos-app form input::placeholder{
  font-style: italic;
  font-weight: 300;
  color: #aaa;
}
</style>
