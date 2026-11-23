---
"miniflare": patch
---

Dispose the temporary RPC stub resolved when looking up a method through the Node.js binding proxy

Looking up a method on a Workers RPC binding from Node.js resolved an `RpcProperty` to a temporary `RpcStub` and then dropped it, so `workerd` warned that an RPC stub was not disposed properly. The stub is now disposed as soon as the method name has been resolved, before the client looks the method up again for its call.