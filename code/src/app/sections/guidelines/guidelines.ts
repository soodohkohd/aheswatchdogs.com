import { Component } from '@angular/core';

@Component({
  selector: 'app-guidelines',
  templateUrl: './guidelines.html',
  styleUrl: './guidelines.scss',
})
export class Guidelines {
  protected readonly hours = [
    'Playground hours: 9:30 AM – 1:20 PM.',
    'Commit to staying for the entire recess block (about 20 minutes).',
    'Check in and out at the front office and sign in/out through Raptor each time you are on campus.',
    'Notify playground staff when you arrive on the playground and before you leave.',
    'Assist with Raptor Express Lanes at Friday Flag as directed.',
    'Watch D.O.G.S. shirts must be worn whenever serving on campus.',
  ];

  protected readonly dos = [
    'Be a visible, positive presence for students.',
    'Supervise actively: scan the playground, walk around, and engage with students.',
    'Step in to help maintain safety and fair play.',
    'Encourage students to use kind words and include others.',
    'Support playground staff by reinforcing expectations they’ve set.',
    'Follow school staff directions at all times.',
    'Complete the required training videos provided by the School Coordinator.',
  ];

  protected readonly donts = [
    'Don’t discipline students yourself — notify playground staff if there’s an issue.',
    'Don’t engage in rough play or activities that could create safety risks.',
    'Don’t use your phone except in an emergency.',
    'Don’t leave your assigned area without letting playground staff know.',
    'Don’t share personal contact information with students.',
    'Don’t leave early without checking out with the office and playground staff.',
  ];
}
