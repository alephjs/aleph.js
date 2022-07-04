<script lang="ts">
import { defineComponent, h } from "vue";
import Header from "../components/Header.vue";

export default defineComponent({
  render() {
    return [
      h(Header),
      this.$slots.default ? this.$slots.default() : [],
    ]
  }
})
</script>
