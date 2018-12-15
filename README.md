# ShareReplay Doesn't Clear Its Replay Buffer

[ShareReplay](https://www.learnrxjs.io/operators/multicasting/sharereplay.html) is an RXJS operator which is very useful for managing expensive [cold observable](https://blog.thoughtram.io/angular/2016/06/16/cold-vs-hot-observables.html) operations, sharing the source observable for concurrent subscribers, and replaying the result to subsequent subscribers without performing the operation again.  This isn't ShareReplay's only use-case, but that use-case was the inspiration for this blog post, so that's the use case that we'll be discussing here.  It works by:
* Multicasting the source observable (thus making it hot) so that the operation is not duplicated for concurrent subscribers
* Storing the result in a [ReplaySubject](https://xgrommx.github.io/rx-book/content/subjects/replay_subject/index.html) in order to replay the result to future subscribers without having to perform the operation again.
* Using [refCount](https://blog.angularindepth.com/rxjs-how-to-use-refcount-73a0c6619a4e) connect to the source observable on the first subscription and to disconnect once the number of subscribers reaches zero.

One important thing to understand about ShareReplay, however, is that ShareReplay does not clear its underlying ReplaySubject (and, by extension, the previously emitted values in the buffer) when the subscriber count reaches zero.  I recently ran into some confusion about this due to conflicting information on the internet, so I'd like to clarify that here for anybody else who runs into the same issue.

One of the first few articles that I came across while learning about ShareReplay and related operators was [this](https://medium.com/@_achou/rxswift-share-vs-replay-vs-sharereplay-bea99ac42168) one, which states near the end that "When the reference count of subscribers drops to zero, the replay buffer is cleared."  This threw me off when my ShareReplay operators were continuing to emit previously-emitted values after all of my subscribers had unsubscribed.

Upon further research I came across [this](https://github.com/ReactiveX/rxjs/issues/3336) issue on Github which discusses the operation of ShareReplay in depth and [this](https://github.com/ReactiveX/rxjs/issues/3336#issuecomment-404684615) comment in particular, which explains that the ReplaySubject is reused by design, and that if you want the buffer to be cleared when the subscriber count reaches zero "you need to pass a factory to multicast".  We can confirm this by reading the [ShareReplay source code](https://github.com/ReactiveX/rxjs/blob/master/src/internal/operators/shareReplay.ts): the underlying ReplaySubject is never actually cleared out or recreated after initial creation.  This is a critical detail.

When storing fetched data in a buffer it's important to keep in mind how long you want to keep previously-emitted values in a buffer, which is usually a function of how frequently the data changes and how important it is to have the current version of said data at any given time.

# Examples Via Jasmine Tests
Let's demonstrate the buffer lifetime of a ShareReplay and compare it with that of the aforementioned multicast factory alternative with a few Jasmine tests.  I've created a simple Angular app which consists of a single service which makes a simple HTTP request and a set of unit tests demonstrating the buffer and multicast functionality of ShareReplay and the aforementioned multicast-factory-based alternative.  You can view the full source of the service [here](https://github.com/pfbrowning/sharereplay-buffer-example/blob/master/src/app/services/dummy-http-request.service.ts) and the tests [here](https://github.com/pfbrowning/sharereplay-buffer-example/blob/master/src/app/services/dummy-http-request.service.spec.ts).

## Standard Case: Non-Buffered HTTP Request
If buffering is not a concern and you don't expect multiple concurrent subscribers, then simply fetching your resource directly is probably sufficient.
Here we'll demonstrate the obvious: if you subscribe to an HTTP request twice, it will perform the HTTP request twice:
```typescript
it('should perform the regular http request twice', () => {
// Subscribe to the standard http request
httpRequestSub1 = dummyHttpRequestService.getHttpResource().subscribe(
    next => httpRequestSubSpy.emit(next),
    error => httpRequestSubSpy.error(error),
    () => httpRequestSubSpy.complete()
);

// Use the http mock backend to flush an HTTP response of 'test value 1'
const request1 = httpTestingController.expectOne('/resource');
request1.flush('test value 1');

/* Expect that the spy has observed one value emitted, and that it 
was the 'test value 1' provided by the mock backend */
expect(httpRequestSubSpy.emit).toHaveBeenCalledTimes(1);
expect(httpRequestSubSpy.emit.calls.mostRecent().args).toEqual(['test value 1']);

// Subscribe to the same resource again
httpRequestSub1 = dummyHttpRequestService.getHttpResource().subscribe(
    next => httpRequestSubSpy.emit(next),
    error => httpRequestSubSpy.error(error),
    () => httpRequestSubSpy.complete()
);

/* Since we're not piping the request through any sort of replay operator,
we can expect this request to be made a second time.  This time we'll flush
'test value 2' to differentiate it from the first. */
const request2 = httpTestingController.expectOne('/resource');
request2.flush('test value 2');

/* Expect that a second value emitted and that it was the 'test value 2' that we
just flushed from the mock backend. */
expect(httpRequestSubSpy.emit).toHaveBeenCalledTimes(2);
expect(httpRequestSubSpy.emit.calls.mostRecent().args).toEqual(['test value 2']);

// Verify that there are no outstanding HTTP requests
httpTestingController.verify();
});
```
## ShareReplay(1): Indefinite Buffering
If you want to perform an operation only once and share the result to any concurrent or subsequent subscribers, then using a ShareReplay with a buffer size of 1 is a good solution.  Here we'll demonstrate that the ShareReplay buffer is not cleared when the number of subscribers reaches zero:
```typescript
it('should store the response in a buffer for subsequent subscribers when going through shareReplay, even after refCount reaches 0', () => {
/* Create an observable which pipes the http request through a shareReplay with buffer size 1
in order to demonstrate its buffer functionality.  Note that we're creating one observable to 
reuse across multiple subscriptions, rather than subscribing to a function which creates a new 
observable on each call. */
let shareReplayObservable = dummyHttpRequestService.getHttpResource().pipe(shareReplay(1));
/* Subscribe to the shareReplay observable twice in order to demonstrate the 'share' part
of its functionality: the source observable is shared amongst concurrent subscribers.  As
a result, the HTTP request is executed only once and the result is shared among both
subscribers. */
httpRequestSub1 = shareReplayObservable.subscribe(
    next => httpRequestSubSpy.emit(next),
    error => httpRequestSubSpy.error(error),
    () => httpRequestSubSpy.complete()
);
httpRequestSub2 = shareReplayObservable.subscribe(
    next => httpRequestSubSpy.emit(next),
    error => httpRequestSubSpy.error(error),
    () => httpRequestSubSpy.complete()
);

// Expect that a single request was made, and flush a response of 'test value'
const request = httpTestingController.expectOne('/resource');
request.flush('test value');

// Expect that 'test value' was emitted by both subscribers
expect(httpRequestSubSpy.emit).toHaveBeenCalledTimes(2);
expect(httpRequestSubSpy.emit.calls.argsFor(0)).toEqual(['test value']);
expect(httpRequestSubSpy.emit.calls.argsFor(1)).toEqual(['test value']);
expect(httpRequestSubSpy.complete).toHaveBeenCalledTimes(2);

/* Expect that both subscriptions are closed.  We can infer that the
refCount has reached zero and disconnected by this point. */
expect(httpRequestSub1.closed).toBe(true);
expect(httpRequestSub2.closed).toBe(true);

// Subscribe to the same observable again
httpRequestSub1 = shareReplayObservable.subscribe(
    next => httpRequestSubSpy.emit(next),
    error => httpRequestSubSpy.error(error),
    () => httpRequestSubSpy.complete()
);

/* Expect that the same value was emitted again */
expect(httpRequestSubSpy.emit).toHaveBeenCalledTimes(3);
expect(httpRequestSubSpy.emit.calls.mostRecent().args).toEqual(['test value']);

/* Verify that there are no outstanding HTTP requests.  Note that we only flushed &
expected a single HTTP request.  This tells us that the HTTP request was performed
only once, although we subscribed to the observable multiple times and the refCount
reached zero in between subscriptions.  This demonstrates that the ShareReplay
buffer is not cleared when the refCount reaches zero. */
httpTestingController.verify();
});
```
## Multicasted ReplaySubject With RefCount: Buffer Clears When RefCount Reaches Zero
If you want your buffer to automatically clear itself after all subscribers have disconnected, then this is a better fit.
```typescript
it('should not reuse the buffer upon refCount reaching zero when using a multicast factory', () => {
    /* Create an observable which pipes the http request through a multicast factory which creates a ReplaySubject
    with a buffer size of 1 on each initialization, and which uses refCount to connect and disconnect based
    on the number of active subscribers. */
    let multicastFactoryObservable = dummyHttpRequestService.getHttpResource().pipe(
      multicast(() => new ReplaySubject(1)),
      refCount()
    )
    /* Subscribe to the same observable twice before flushing a response in order
    to demonstrate the multicast & refCount functionality.  Since we're multicasting,
    we'll share the same result to multiple subscribers.  refCount will connect
    on the first subscription, and when the second subscriber comes along the ref
    count will be internally incremented to two. */
    httpRequestSub1 = multicastFactoryObservable.subscribe(
      next => httpRequestSubSpy.emit(next),
      error => httpRequestSubSpy.error(error),
      () => httpRequestSubSpy.complete()
    );
    httpRequestSub2 = multicastFactoryObservable.subscribe(
      next => httpRequestSubSpy.emit(next),
      error => httpRequestSubSpy.error(error),
      () => httpRequestSubSpy.complete()
    );

    // Expect a single HTTP request to be initiated by the subscriptions to the multicasted observable
    const request1 = httpTestingController.expectOne('/resource');
    request1.flush('test value 1');

    // Expect that both subscriptions emitted the same value
    expect(httpRequestSubSpy.emit).toHaveBeenCalledTimes(2);
    expect(httpRequestSubSpy.emit.calls.argsFor(0)).toEqual(['test value 1']);
    expect(httpRequestSubSpy.emit.calls.argsFor(1)).toEqual(['test value 1']);
    expect(httpRequestSubSpy.complete).toHaveBeenCalledTimes(2);
    
    /* Expect that both subscriptions are closed.  We can infer that the
    refCount has reached zero and disconnected by this point. */
    expect(httpRequestSub1.closed).toBe(true);
    expect(httpRequestSub2.closed).toBe(true);

    // Subscribe to the same observable again
    httpRequestSub1 = multicastFactoryObservable.subscribe(
      next => httpRequestSubSpy.emit(next),
      error => httpRequestSubSpy.error(error),
      () => httpRequestSubSpy.complete()
    );

    /* Since the refCount had previously reached zero, but this time we're using a
    multicast factory (rather than a ShareReplay), we expect that a new ReplaySubject will be created and that
    a new HTTP request will be performed.*/
    const request2 = httpTestingController.expectOne('/resource');
    // Flush a different value to differentiate the new response from the old
    request2.flush('test value 2');

    // Expect that the newly-flushed value was emitted
    expect(httpRequestSubSpy.emit).toHaveBeenCalledTimes(3);
    expect(httpRequestSubSpy.emit.calls.mostRecent().args).toEqual(['test value 2']);

    // Ensure that there are no outstanding HTTP requests.
    httpTestingController.verify();
});
```