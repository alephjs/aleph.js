<script setup>
import { ref } from "vue"
import { Link } from "aleph/vue"

const msg = ref("hello page")
</script>

<template>
    <h2>{{ msg }}</h2>
    <br />
    <Link to="/">go back</Link>
</template>