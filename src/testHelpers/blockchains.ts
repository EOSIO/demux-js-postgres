export default {
  blockchain: [
    {
      blockInfo: {
        blockNumber: 1,
        blockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        previousBlockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        timestamp: new Date('2018-06-06T11:53:37.000'),
      },
      actions: [
        {
          type: 'add_todo',
          payload: {
            todoName: 'Groceries',
            id: 1,
          },
        },
        {
          type: 'add_todo',
          payload: {
            todoName: 'Places to Visit',
            id: 2,
          },
        },
      ],
    },
    {
      blockInfo: {
        blockNumber: 2,
        blockHash: '0000000000000000000000000000000000000000000000000000000000000001',
        previousBlockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        timestamp: new Date('2018-06-06T11:53:37.500'),
      },
      actions: [
        {
          type: 'add_tasks',
          payload: {
            todoId: 1,
            tasks: [
              'apples',
              'bananas',
              'pears',
              'milk',
              'cookies',
            ],
          },
        },
        {
          type: 'add_tasks',
          payload: {
            todoId: 2,
            tasks: [
              'Hong Kong',
              'Sydney',
              'London',
              'San Francisco',
            ],
          },
        },
      ],
    },
    {
      blockInfo: {
        blockNumber: 3,
        blockHash: '0000000000000000000000000000000000000000000000000000000000000002',
        previousBlockHash: '0000000000000000000000000000000000000000000000000000000000000001',
        timestamp: new Date('2018-06-06T11:53:38.000'),
      },
      actions: [
        {
          type: 'update_task',
          payload: {
            todoId: 1,
            taskName: 'milk',
            completed: true,
          },
        },
        {
          type: 'update_task',
          payload: {
            todoId: 1,
            taskName: 'cookies',
            completed: true,
          },
        },
        {
          type: 'update_task',
          payload: {
            todoId: 2,
            taskName: 'Hong Kong',
            completed: true,
          },
        },
      ],
    },
  ],
  forked: [
    {
      blockInfo: {
        blockNumber: 1,
        blockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        previousBlockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        timestamp: new Date('2018-06-06T11:53:37.000'),
      },
      actions: [
        {
          type: 'add_todo',
          payload: {
            todoName: 'Groceries',
            id: 1,
          },
        },
        {
          type: 'add_todo',
          payload: {
            todoName: 'Places to Visit',
            id: 2,
          },
        },
      ],
    },
    {
      blockInfo: {
        blockNumber: 2,
        blockHash: 'F000000000000000000000000000000000000000000000000000000000000001',
        previousBlockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        timestamp: new Date('2018-06-06T11:53:37.500'),
      },
      actions: [
        {
          type: 'add_tasks',
          payload: {
            todoId: 1,
            tasks: [
              'apples',
              'bananas',
              'pears',
              'milk',
              'cookies',
              'Forked blockchain',
            ],
          },
        },
        {
          type: 'add_tasks',
          payload: {
            todoId: 2,
            tasks: [
              'Hong Kong',
              'Sydney',
              'London',
              'San Francisco',
            ],
          },
        },
      ],
    },
    {
      blockInfo: {
        blockNumber: 3,
        blockHash: 'F000000000000000000000000000000000000000000000000000000000000002',
        previousBlockHash: 'F000000000000000000000000000000000000000000000000000000000000001',
        timestamp: new Date('2018-06-06T11:53:38.000'),
      },
      actions: [
        {
          type: 'update_task',
          payload: {
            todoId: 1,
            taskName: 'milk',
            completed: true,
          },
        },
        {
          type: 'update_task',
          payload: {
            todoId: 1,
            taskName: 'cookies',
            completed: true,
          },
        },
        // Removed Hong Kong completion from fork
      ],
    },
    {
      blockInfo: {
        blockNumber: 4,
        blockHash: 'F000000000000000000000000000000000000000000000000000000000000003',
        previousBlockHash: 'F000000000000000000000000000000000000000000000000000000000000002',
        timestamp: new Date('2018-06-06T11:53:39.000'),
      },
      actions: [
        {
          type: 'update_task',
          payload: {
            todoId: 1,
            taskName: 'Forked blockchain',
            completed: true,
          },
        },
      ],
    },
  ],
}
