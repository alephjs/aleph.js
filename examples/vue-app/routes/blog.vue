<script setup>
import { ref } from "vue"
import { Link } from "aleph/vue"

const msg = ref("blog page")
</script>

<template>
    <h2>{{ msg }}</h2>
    <br />
    <Link to="/">go back</Link>
</template>