<script setup>
import { ref } from "vue"

const msg = ref("hello page")

function click() {
    location.pathname = ''
}
</script>

<template>
    <div>{{ msg }}</div>
    <button @click="click">home page</button>
</template>