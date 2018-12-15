import { TestBed } from '@angular/core/testing';
import { DummyHttpRequestService } from './dummy-http-request.service';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Subscription, ReplaySubject } from 'rxjs';
import { shareReplay, multicast, refCount } from 'rxjs/operators';

describe('DummyHttpRequestService', () => {
  let dummyHttpRequestService: DummyHttpRequestService;
  let httpTestingController: HttpTestingController;
  let httpRequestSub1: Subscription;
  let httpRequestSub2: Subscription;
  let httpRequestSubSpy: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule
      ]
    });

    httpTestingController = TestBed.get(HttpTestingController);
    dummyHttpRequestService = TestBed.get(DummyHttpRequestService);
    httpRequestSubSpy = jasmine.createSpyObj('httpRequestSubscription', ['emit', 'error', 'complete']);
  });

  it('should be created', () => {
    expect(dummyHttpRequestService).toBeTruthy();
  });

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
});
