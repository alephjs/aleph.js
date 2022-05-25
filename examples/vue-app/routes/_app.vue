<script lang="ts">
import Header from "../components/Header.vue";
import { defineComponent, h } from "vue";

export default defineComponent({
  setup() {
    return {
      Header
    }
  },
  render() {
    return [
      h(Header),
      this.$slots.default ? this.$slots.default() : [],
    ]
  }
})
</script>
