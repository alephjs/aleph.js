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

<style scoped>
h2 {
    font-size: 24px;
    font-weight: 600;
    line-height: 1;
    color: #42b883;
    margin: 0;
}
</style>