<script setup>
import { ref } from "vue"
import { Link } from "aleph/vue"

const msg = ref("Hello world!")
</script>

<template>
  <h1 v-if="msg">{{ msg }}</h1>
  <h1 v-if="!msg" style="color: #ccc;">Please type something</h1>
  <input v-model="msg" placeholder="Please type something">
  <Link to="/hello">hello page</Link>
  <br />
  <Link to="/blog">blog page</Link>
</template>

<style scoped>
h1 {
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
  color: #42b883;
  margin: 0;
}

input {
  display: block;
  width: 300px;
  height: 36px;
  line-height: 36px;
  padding: 0 12px;
  margin: 12px 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background-color: #f3f3f3;
}

input:focus {
  border: 1px solid #999;
  background-color: white;
}
</style>
