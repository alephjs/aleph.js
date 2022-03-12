<script setup>
  import { ref } from "vue"

  const msg = ref("Hello World!")
</script>

<template>
  <h1>{{ msg }}</h1>
  <input v-model="msg">
</template>

<style scoped>
  h1 {
    font-size: 30px;
    line-height: 2;
  }
</style>