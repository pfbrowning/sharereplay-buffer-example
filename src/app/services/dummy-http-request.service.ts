import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({providedIn: 'root'})
export class DummyHttpRequestService {
  constructor(private httpClient: HttpClient) {}

  public getHttpResource(): Observable<string> {
    return this.httpClient.get<string>('/resource');
  }
}
